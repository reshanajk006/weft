require('../../shared/tracer').initTracer('catalog-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const products = [
  { id: 'p-001', name: 'IBM Power10 Server Blade', category: 'Hardware', price: 24500, stock: 14 },
  { id: 'p-002', name: 'Red Hat OpenShift Enterprise', category: 'Software', price: 12000, stock: 99 },
  { id: 'p-003', name: 'Cloud Pak for Data License', category: 'Software', price: 35000, stock: 45 },
  { id: 'p-004', name: 'Enterprise SAN Storage Array 100TB', category: 'Hardware', price: 58000, stock: 6 },
  { id: 'p-005', name: 'Managed Kubernetes Cluster', category: 'Cloud', price: 8500, stock: 50 },
];

app.get('/health', (req, res) => res.json({ service: 'catalog-service', status: 'UP' }));

app.get('/products', (req, res) => res.json({ products, total: products.length }));

app.get('/products/:id', (req, res) => {
  const p = products.find(prod => prod.id === req.params.id) || products[0];
  res.json(p);
});

app.listen(PORT, () => {
  console.log(`[catalog-service] Listening on port ${PORT}`);
});
