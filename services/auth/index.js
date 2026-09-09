require('../../shared/tracer').initTracer('auth-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ service: 'auth-service', status: 'UP' }));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await axios.get(`${USER_SERVICE_URL}/users/by-email?email=${encodeURIComponent(email || 'admin@nexus-it.com')}`);
    const user = userRes.data;

    res.json({
      token: `jwt-token-nexus-${Date.now()}`,
      user: {
        id: user.id || 'u-001',
        name: user.name || 'Enterprise Admin',
        email: user.email || 'admin@nexus-it.com',
        role: user.role || 'SYS_ADMIN'
      }
    });
  } catch (err) {
    res.json({
      token: `jwt-token-nexus-${Date.now()}`,
      user: { id: 'u-001', name: 'Enterprise Admin', email: 'admin@nexus-it.com', role: 'SYS_ADMIN' }
    });
  }
});

app.post('/verify', (req, res) => {
  res.json({ valid: true, userId: 'u-001', scope: ['all'] });
});

app.listen(PORT, () => {
  console.log(`[auth-service] Listening on port ${PORT}`);
});
