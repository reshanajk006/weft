require('../../shared/tracer').initTracer('user-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3002;

const { chaosMiddleware } = require('../../shared/chaos');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(chaosMiddleware('user-service'));

const users = [
  { id: 'u-001', name: 'Alexander Wright', email: 'admin@nexus-it.com', role: 'SYS_ADMIN', department: 'IT Infrastructure' },
  { id: 'u-002', name: 'Sophia Chen', email: 'sophia.c@nexus-it.com', role: 'DEVOPS_LEAD', department: 'Cloud Platform' },
  { id: 'u-003', name: 'Marcus Vance', email: 'marcus.v@nexus-it.com', role: 'SEC_OPS', department: 'Cybersecurity' },
];

app.get('/health', (req, res) => res.json({ service: 'user-service', status: 'UP' }));

app.get('/users', (req, res) => res.json({ users, total: users.length }));

app.get('/users/by-email', (req, res) => {
  const user = users.find(u => u.email === req.query.email) || users[0];
  res.json(user);
});

app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === req.params.id) || users[0];
  res.json(user);
});

app.listen(PORT, () => {
  console.log(`[user-service] Listening on port ${PORT}`);
});
