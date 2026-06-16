module.exports = async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }
  res.status(200).json({ token: 'demo-token', user: { id: 'user-001', email, role: 'owner' } });
};
