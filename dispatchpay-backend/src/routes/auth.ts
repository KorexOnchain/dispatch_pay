import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';

const router = Router();

function recoverAddress(message: string, signature: string): string {
  const { ecdsaRecover } = require('secp256k1');
  const msgHash = createHash('sha256')
    .update(`\x19Ethereum Signed Message:\n${message.length}${message}`)
    .digest();
  const sigBuf = Buffer.from(signature.slice(2), 'hex');
  const r = sigBuf.slice(0, 32);
  const s = sigBuf.slice(32, 64);
  const v = sigBuf[64];
  const recovery = v < 27 ? v : v - 27;
  const pubKey = ecdsaRecover(Buffer.concat([r, s]), recovery, msgHash, false);
  const pubKeyHash = createHash('sha256').update(pubKey.slice(1)).digest('hex');
  return '0x' + pubKeyHash.slice(-40);
}

router.get('/nonce/:address', async (req: Request, res: Response): Promise<void> => {
  const address = (req.params['address'] as string).toLowerCase();
  const nonce = randomBytes(16).toString('hex');

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

router.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { address, signature } = req.body as { address: string; signature: string };

  if (!address || !signature) {
    res.status(400).json({ error: 'Address and signature are required' });
    return;
  }

  const normalizedAddress = address.toLowerCase();
  const record = await prisma.nonce.findUnique({ where: { address: normalizedAddress } });

  if (!record) {
    res.status(400).json({ error: 'No nonce found. Request a nonce first.' });
    return;
  }

  const message = `Sign in to DispatchPay\nNonce: ${record.nonce}`;

  try {
    const { verifyMessage } = await import('ethers');
    const recovered = verifyMessage(message, signature).toLowerCase();

    if (recovered !== normalizedAddress) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  await prisma.nonce.delete({ where: { address: normalizedAddress } });

  const token = jwt.sign({ address: normalizedAddress }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token });
});

export default router;