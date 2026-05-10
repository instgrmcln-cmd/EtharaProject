// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required. Please login.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SEC);
    
    const user = await User.findById(decoded._id).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found. Please login again.' });
    }

    // Attach user info to request (including isAdmin)
    req.user = {
      id: user._id.toString(),
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      isAdmin: user.isAdmin  // Add this
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token. Please login again.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired. Please login again.' });
    }
    return res.status(500).json({ message: 'Authentication error', error: error.message });
  }
};

// Check if user is a project member and get their role
const checkProjectMember = async (req, res, next) => {
  try {
    const Project = require('../models/projectModel');
    const projectId = req.params.projectId || req.body.projectId;
    
    if (!projectId) {
      return res.status(400).json({ message: 'Project ID is required' });
    }

    const project = await Project.findById(projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const member = project.members.find(m => {
      const memberId = m.user.toString ? m.user.toString() : m.user;
      const userId = req.user._id.toString();
      return memberId === userId;
    });

    if (!member) {
      // If user is system admin, allow access
      if (req.user.isAdmin) {
        req.project = project;
        req.projectMemberRole = 'admin';
        return next();
      }
      return res.status(403).json({ message: 'You are not a member of this project' });
    }

    req.project = project;
    req.projectMemberRole = member.role;
    
    next();
  } catch (error) {
    console.error('checkProjectMember error:', error);
    return res.status(500).json({ message: 'Error checking project membership', error: error.message });
  }
};

const authorizeProjectRole = (...roles) => {
  return (req, res, next) => {
    if (!req.projectMemberRole) {
      return res.status(403).json({ message: 'Project role not found.' });
    }

    if (!roles.includes(req.projectMemberRole)) {
      return res.status(403).json({ 
        message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.projectMemberRole}` 
      });
    }
    
    next();
  };
};

module.exports = { authenticate, checkProjectMember, authorizeProjectRole };