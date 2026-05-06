import { Router, Request, Response } from 'express';
import { verifyMessage } from 'viem';
import { prisma } from '../prisma';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

const router = Router();

// Step 1: Request a nonce
router.get('/nonce/:address', async (req: Request, res: Response): Promise<void> => {
  const address = (req.params['address'] as string).toLowerCase();
  const nonce = randomBytes(16).toString('hex');

  // Ensure user exists before creating nonce
  await prisma.user.upsert({
    where: { address },
    update: {},
    create: { address, name: '', phone: '', role: 'BUYER' },
  });

  await prisma.nonce.upsert({
    where: { address },
    update: { nonce },
    create: { address, nonce },
  });

  res.json({ nonce });
});

// Step 2: Verify signature + issue JWT
router.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { address, signature } = req.body as { address: string; signature: `0x${string}` };

  if (!address || !signature) {
    res.status(400).json({ error: 'Address and signature are required' });
    return;
  }

  const normalizedAddress = address.toLowerCase();

  const record = await prisma.nonce.findUnique({
    where: { address: normalizedAddress },
  });

  if (!record) {
    res.status(400).json({ error: 'No nonce found. Request a nonce first.' });
    return;
  }

  const message = `Sign in to DispatchPay\nNonce: ${record.nonce}`;

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature,
  });

  if (!valid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Invalidate nonce immediately (prevent replay attacks)
  await prisma.nonce.delete({ where: { address: normalizedAddress } });

  const token = jwt.sign({ address: normalizedAddress }, process.env.JWT_SECRET!, {
    expiresIn: '7d',
  });

  res.json({ token });
});

export default router;
