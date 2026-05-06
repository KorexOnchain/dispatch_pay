import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Register user profile after wallet connect
router.post('/register', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { name, phone, role } = req.body as { name: string; phone: string; role: 'BUYER' | 'SELLER' };
  const address = (req as any).address;

  if (!name || !phone || !role) {
    res.status(400).json({ error: 'Name, phone and role are required' });
    return;
  }

  if (!['BUYER', 'SELLER'].includes(role)) {
    res.status(400).json({ error: 'Role must be BUYER or SELLER' });
    return;
  }

  try {
    const user = await prisma.user.upsert({
      where: { address },
      update: { name, phone, role },
      create: { address, name, phone, role },
    });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const address = (req as any).address;

  try {
    const user = await prisma.user.findUnique({ where: { address } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;