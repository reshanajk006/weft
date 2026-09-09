require('../../shared/tracer').initTracer('analytics-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3007;

const { chaosMiddleware } = require('../../shared/chaos');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(chaosMiddleware('analytics-service'));

const events = [];

app.get('/health', (req, res) => res.json({ service: 'analytics-service', status: 'UP' }));

app.post('/events', (req, res) => {
  events.push(req.body);
  res.json({ recorded: true, totalEvents: events.length });
});

app.get('/dashboard', (req, res) => {
  res.json({
    metrics: {
      activeUsers: 1420,
      totalOrdersToday: 89,
      revenueToday: 412500,
      systemHealthScore: '99.98%'
    },
    recentEventsCount: events.length
  });
});

app.listen(PORT, () => {
  console.log(`[analytics-service] Listening on port ${PORT}`);
});
