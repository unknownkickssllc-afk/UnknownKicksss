const { adminConfigurationError } = require("../lib/adminAuth");

function requireAdmin(req, res, next) {
  const error = adminConfigurationError();
  if (error) return res.status(503).json({ error });
  if (req.session?.adminAuthenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
}

function requireAdminPage(req, res, next) {
  if (adminConfigurationError() || !req.session?.adminAuthenticated) {
    return res.redirect(302, "/admin/");
  }
  next();
}

module.exports = { requireAdmin, requireAdminPage };
