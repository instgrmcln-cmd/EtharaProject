// routes/projectRoutes.js
const router = require('express').Router();
const Project = require('../models/projectModel');
const Task = require('../models/taskModel');
const User = require('../models/userModel');
const { authenticate, checkProjectMember, authorizeProjectRole } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// CREATE PROJECT
router.post('/', async (req, res) => {
  try {
    const newProject = new Project({
      name: req.body.name,
      description: req.body.description,
      createdBy: req.user._id, // Using _id like your auth
      members: [{
        user: req.user._id,
        role: 'admin'
      }]
    });

    const savedProject = await newProject.save();
    
    // Populate member details
    const populatedProject = await Project.findById(savedProject._id)
      .populate('members.user', 'fullName email')
      .populate('createdBy', 'fullName email');

    res.status(201).json(populatedProject);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// GET ALL PROJECTS (User is member of)
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({
      'members.user': req.user._id
    })
    .populate('members.user', 'fullName email')
    .populate('createdBy', 'fullName email')
    .sort({ createdAt: -1 });

    // Add task statistics to each project
    const projectsWithStats = await Promise.all(
      projects.map(async (project) => {
        const taskCount = await Task.countDocuments({ project: project._id });
        const completedCount = await Task.countDocuments({ 
          project: project._id, 
          status: 'done' 
        });
        
        return {
          ...project.toObject(),
          taskStats: {
            total: taskCount,
            completed: completedCount,
            pending: taskCount - completedCount
          }
        };
      })
    );

    res.status(200).json(projectsWithStats);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET SINGLE PROJECT (With tasks)
router.get('/:projectId', async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId)
      .populate('members.user', 'fullName email')
      .populate('createdBy', 'fullName email');

    // Get project tasks
    const tasks = await Task.find({ project: req.params.projectId })
      .populate('assignedTo', 'fullName email')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      project,
      tasks
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// UPDATE PROJECT (Admin only)
router.put('/:projectId', checkProjectMember, authorizeProjectRole('admin'), async (req, res) => {
  try {
    const updatedProject = await Project.findByIdAndUpdate(
      req.params.projectId,
      { $set: { name: req.body.name, description: req.body.description } },
      { new: true, runValidators: true }
    ).populate('members.user', 'fullName email')
     .populate('createdBy', 'fullName email');

    res.status(200).json(updatedProject);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// DELETE PROJECT (Admin only)
router.delete('/:projectId', checkProjectMember, authorizeProjectRole('admin'), async (req, res) => {
  try {
    // Delete all tasks in the project
    await Task.deleteMany({ project: req.params.projectId });
    
    // Delete the project
    await Project.findByIdAndDelete(req.params.projectId);

    res.status(200).json({ message: 'Project and all associated tasks deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ADD MEMBER TO PROJECT
router.post('/:projectId/members', checkProjectMember, authorizeProjectRole('admin'), async (req, res) => {
  try {
    const { userId, role } = req.body;

    // Check if user exists
    const userToAdd = await User.findById(userId);
    if (!userToAdd) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already a member
    const isAlreadyMember = req.project.members.some(
      m => m.user.toString() === userId
    );

    if (isAlreadyMember) {
      return res.status(400).json({ message: 'User is already a member of this project' });
    }

    // Add new member
    req.project.members.push({
      user: userId,
      role: role || 'member'
    });

    await req.project.save();

    // Return updated project with populated fields
    const updatedProject = await Project.findById(req.params.projectId)
      .populate('members.user', 'fullName email')
      .populate('createdBy', 'fullName email');

    res.status(200).json(updatedProject);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// REMOVE MEMBER FROM PROJECT
router.delete('/:projectId/members/:userId', checkProjectMember, authorizeProjectRole('admin'), async (req, res) => {
  try {
    const memberToRemove = req.project.members.find(
      m => m.user.toString() === req.params.userId
    );

    if (!memberToRemove) {
      return res.status(404).json({ message: 'Member not found in project' });
    }

    // Cannot remove the last admin
    if (memberToRemove.role === 'admin') {
      const adminCount = req.project.members.filter(m => m.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ 
          message: 'Cannot remove the last admin. Transfer admin role first.' 
        });
      }
    }

    // Remove the member
    req.project.members = req.project.members.filter(
      m => m.user.toString() !== req.params.userId
    );

    await req.project.save();

    // Unassign tasks assigned to removed member (optional)
    await Task.updateMany(
      { project: req.params.projectId, assignedTo: req.params.userId },
      { $unset: { assignedTo: "" } }
    );

    const updatedProject = await Project.findById(req.params.projectId)
      .populate('members.user', 'fullName email')
      .populate('createdBy', 'fullName email');

    res.status(200).json(updatedProject);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// CHANGE MEMBER ROLE
router.patch('/:projectId/members/:userId/role', checkProjectMember, authorizeProjectRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin or member' });
    }

    const memberIndex = req.project.members.findIndex(
      m => m.user.toString() === req.params.userId
    );

    if (memberIndex === -1) {
      return res.status(404).json({ message: 'Member not found' });
    }

    // If demoting last admin
    if (role === 'member' && req.project.members[memberIndex].role === 'admin') {
      const adminCount = req.project.members.filter(m => m.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ 
          message: 'Cannot change role of the last admin. Promote another member first.' 
        });
      }
    }

    req.project.members[memberIndex].role = role;
    await req.project.save();

    const updatedProject = await Project.findById(req.params.projectId)
      .populate('members.user', 'fullName email');

    res.status(200).json(updatedProject);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

module.exports = router;