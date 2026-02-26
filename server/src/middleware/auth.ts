import { Request, Response, NextFunction } from 'express';

export function requireKeeperAuth(req: Request, res: Response, next: NextFunction) {
  const apiSecret = process.env.KEEPER_API_SECRET;
  if (!apiSecret) {
    return res.status(500).json({ error: 'Keeper not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
