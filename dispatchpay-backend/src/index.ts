import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import orderRoutes from './routes/order';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', project: 'DispatchPay' });
});

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/order', orderRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`DispatchPay backend running on port ${PORT}`);
});

export default app;