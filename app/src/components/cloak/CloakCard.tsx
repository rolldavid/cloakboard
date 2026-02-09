'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface CloakCardProps {
  address: string;
  slug: string;
  name: string;
  memberCount: number;
  proposalCount: number;
}

export function CloakCard({ slug, name, memberCount, proposalCount }: CloakCardProps) {
  return (
    <Link href={`/cloak/${slug}`}>
      <motion.div
        className="bg-card border border-border rounded-md p-6 hover:border-accent hover:shadow-md transition-all cursor-pointer"
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
      >
        <h3 className="text-lg font-semibold text-foreground mb-4">{name}</h3>

        <div className="flex gap-6">
          <div>
            <p className="text-2xl font-bold text-accent">{memberCount}</p>
            <p className="text-xs text-foreground-muted uppercase tracking-wide">Members</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-accent">{proposalCount}</p>
            <p className="text-xs text-foreground-muted uppercase tracking-wide">Proposals</p>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
