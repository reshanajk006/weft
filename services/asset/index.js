require('../../shared/tracer').initTracer('asset-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3008;

const { chaosMiddleware } = require('../../shared/chaos');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(chaosMiddleware('asset-service'));

const assets = [
  { id: 'ast-001', name: 'Mainframe Rack #04', location: 'DC-East-1', status: 'OPERATIONAL' },
  { id: 'ast-002', name: 'DB Cluster Leader', location: 'DC-East-2', status: 'OPERATIONAL' },
  { id: 'ast-003', name: 'Edge Gateway Node', location: 'DC-West-1', status: 'DEGRADED' },
];

app.get('/health', (req, res) => res.json({ service: 'asset-service', status: 'UP' }));

app.get('/assets', (req, res) => res.json({ assets, total: assets.length }));

app.listen(PORT, () => {
  console.log(`[asset-service] Listening on port ${PORT}`);
});
