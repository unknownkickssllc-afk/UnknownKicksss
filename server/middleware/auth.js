function requireAdmin(req, res, next) {
  if (req.session?.adminAuthenticated) return next();
  res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireAdmin };
