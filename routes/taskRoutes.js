// routes/taskRoutes.js
const router = require('express').Router();
const Task = require('../models/taskModel');
const Project = require('../models/projectModel');
const { authenticate, checkProjectMember } = require('../middleware/auth');

router.use(authenticate);

// CREATE TASK IN PROJECT
router.post('/:projectId', checkProjectMember, async (req, res) => {
  try {
    const { title, description, assignedTo, priority, dueDate } = req.body;

    // Validate assigned user is a project member
    if (assignedTo) {
      const isMember = req.project.members.some(
        m => m.user.toString() === assignedTo
      );
      if (!isMember) {
        return res.status(400).json({ message: 'Assigned user must be a project member' });
      }
    }

    const newTask = new Task({
      title,
      description,
      project: req.params.projectId,
      createdBy: req.user._id,
      assignedTo: assignedTo || req.user._id,
      priority: priority || 'medium',
      dueDate: dueDate || null,
      status: 'todo'
    });

    const savedTask = await newTask.save();

    const populatedTask = await Task.findById(savedTask._id)
      .populate('assignedTo', 'fullName email')
      .populate('createdBy', 'fullName email')
      .populate('project', 'name');

    res.status(201).json(populatedTask);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// GET ALL TASKS FOR PROJECT (With filters)
router.get('/:projectId', checkProjectMember, async (req, res) => {
  try {
    const { status, priority, assignedTo, search, sort } = req.query;
    
    const filter = { project: req.params.projectId };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Sort options
    let sortOption = { createdAt: -1 }; // default
    if (sort === 'dueDate') sortOption = { dueDate: 1 };
    if (sort === 'priority') sortOption = { priority: -1 };

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'fullName email')
      .populate('createdBy', 'fullName email')
      .populate('project', 'name')
      .sort(sortOption);

    res.status(200).json(tasks);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET SINGLE TASK
router.get('/task/:taskId', async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId)
      .populate('assignedTo', 'fullName email')
      .populate('createdBy', 'fullName email')
      .populate('project', 'name');

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check if user is a member of the task's project
    const project = await Project.findOne({
      _id: task.project,
      'members.user': req.user._id
    });

    if (!project) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json(task);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// UPDATE TASK
router.put('/task/:taskId', async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check permissions
    const project = await Project.findOne({
      _id: task.project,
      'members.user': req.user._id
    });

    if (!project) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const memberRole = project.members.find(
      m => m.user.toString() === req.user._id.toString()
    )?.role;

    const isAssignee = task.assignedTo?.toString() === req.user._id.toString();
    const isCreator = task.createdBy.toString() === req.user._id.toString();
    const isAdmin = memberRole === 'admin';

    if (!isAssignee && !isCreator && !isAdmin) {
      return res.status(403).json({ 
        message: 'You can only update tasks assigned to you or created by you' 
      });
    }

    // If reassigning, validate new assignee is project member
    if (req.body.assignedTo) {
      const isMember = project.members.some(
        m => m.user.toString() === req.body.assignedTo
      );
      if (!isMember) {
        return res.status(400).json({ message: 'New assignee must be a project member' });
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.taskId,
      { $set: req.body },
      { new: true, runValidators: true }
    )
    .populate('assignedTo', 'fullName email')
    .populate('createdBy', 'fullName email')
    .populate('project', 'name');

    res.status(200).json(updatedTask);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// UPDATE TASK STATUS (Quick status change)
router.patch('/task/:taskId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['todo', 'in_progress', 'review', 'done'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check project membership
    const project = await Project.findOne({
      _id: task.project,
      'members.user': req.user._id
    });

    if (!project) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const memberRole = project.members.find(
      m => m.user.toString() === req.user._id.toString()
    )?.role;

    // Only assignee or admin can change status
    if (task.assignedTo?.toString() !== req.user._id.toString() && memberRole !== 'admin') {
      return res.status(403).json({ 
        message: 'Only the assignee or project admin can update task status' 
      });
    }

    task.status = status;
    await task.save();

    res.status(200).json(task);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// DELETE TASK
router.delete('/task/:taskId', async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const project = await Project.findOne({
      _id: task.project,
      'members.user': req.user._id
    });

    if (!project) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const memberRole = project.members.find(
      m => m.user.toString() === req.user._id.toString()
    )?.role;

    const isCreator = task.createdBy.toString() === req.user._id.toString();
    const isAdmin = memberRole === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ 
        message: 'Only task creator or project admin can delete tasks' 
      });
    }

    await Task.findByIdAndDelete(req.params.taskId);

    res.status(200).json({ message: 'Task deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;