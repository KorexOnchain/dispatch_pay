import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware } from '../middleware/auth';
import { createHash, randomBytes } from 'crypto';

const router = Router();

// Create order (buyer locks funds onchain then calls this)
router.post('/create', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { onchainId, sellerAddress, amount, txHash } = req.body as {
    onchainId: string;
    sellerAddress: string;
    amount: string;
    txHash: string;
  };
  const buyerAddress = (req as any).address;

  if (!onchainId || !sellerAddress || !amount) {
    res.status(400).json({ error: 'onchainId, sellerAddress and amount are required' });
    return;
  }

  try {
    const order = await prisma.order.create({
      data: {
        onchainId,
        buyerAddress,
        sellerAddress: sellerAddress.toLowerCase(),
        amount,
        txHash,
      },
    });
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get all orders for current user (as buyer or seller)
router.get('/mine', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const address = (req as any).address;

  try {
    const orders = await prisma.order.findMany({
      where: {
        OR: [{ buyerAddress: address }, { sellerAddress: address }],
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Seller generates OTP for an order
router.post('/:id/generate-otp', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const address = (req as any).address;
  const id = req.params['id'] as string;

  try {
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (order.sellerAddress !== address) {
      res.status(403).json({ error: 'Only the seller can generate OTP' });
      return;
    }

    const otp = randomBytes(3).toString('hex').toUpperCase();
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await prisma.order.update({
      where: { id },
      data: { otpHash, status: 'DELIVERED' },
    });

    res.json({ otp });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

// Buyer verifies OTP to confirm delivery
router.post('/:id/verify-otp', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const address = (req as any).address;
  const id = req.params['id'] as string;
  const { otp } = req.body as { otp: string };

  try {
    const order = await prisma.order.findUnique({ where: { id } });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (order.buyerAddress !== address) {
      res.status(403).json({ error: 'Only the buyer can verify OTP' });
      return;
    }

    const otpHash = createHash('sha256').update(otp).digest('hex');

    if (otpHash !== order.otpHash) {
      res.status(400).json({ error: 'Invalid OTP' });
      return;
    }

    await prisma.order.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    res.json({ success: true, message: 'Delivery confirmed. Funds will be released.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

export default router;
