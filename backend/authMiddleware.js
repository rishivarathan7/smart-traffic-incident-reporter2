const jwt = require('jsonwebtoken');

/**
 * Express Middleware to authenticate requests using JSON Web Tokens (JWT).
 * Expects header: Authorization: Bearer <token>
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  // Header format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }

  const token = parts[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error("JWT_SECRET is not configured in environment variables.");
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }

  jwt.verify(token, secret, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token"
      });
    }

    // Attach authenticated user details to request object
    req.user = {
      userId: decoded.userId,
      role: decoded.role
    };

    next();
  });
}

/**
 * Express Middleware to enforce Admin role authorization.
 * Must be used after authenticateToken.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin
};
