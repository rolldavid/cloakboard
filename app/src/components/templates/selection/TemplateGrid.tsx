'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { TemplateCard } from './TemplateCard';
import { TemplatePreview } from './TemplatePreview';
import {
  CATEGORY_INFO,
  getTemplatesInOrder,
  type TemplateMetadata,
  type TemplateCategory,
} from '@/lib/constants/templates';

interface TemplateGridProps {
  selectedTemplateId?: number | null;
  onSelect: (templateId: number) => void;
}

type FilterCategory = 'all' | TemplateCategory;

/**
 * Grid of template cards with category filter tabs
 */
export function TemplateGrid({ selectedTemplateId, onSelect }: TemplateGridProps) {
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all');
  const [previewTemplate, setPreviewTemplate] = useState<TemplateMetadata | null>(null);

  const categories: { id: FilterCategory; label: string }[] = [
    { id: 'all', label: 'All Templates' },
    ...Object.entries(CATEGORY_INFO).map(([id, info]) => ({
      id: id as TemplateCategory,
      label: info.label,
    })),
  ];

  const filteredTemplates = useMemo(() => {
    const allTemplates = getTemplatesInOrder();
    if (activeCategory === 'all') {
      return allTemplates;
    }
    return allTemplates.filter((t) => t.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className="space-y-6">
      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setActiveCategory(category.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeCategory === category.id
                ? 'bg-accent text-white'
                : 'bg-background-tertiary text-foreground-secondary hover:bg-background-tertiary'
            }`}
          >
            {category.label}
            {category.id !== 'all' && (
              <span className="ml-1.5 opacity-70">
                ({getTemplatesInOrder().filter((t) => t.category === category.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {filteredTemplates.map((template) => (
          <motion.div key={template.id} variants={staggerItem}>
            <TemplateCard
              template={template}
              onSelect={onSelect}
              onPreview={setPreviewTemplate}
              isSelected={selectedTemplateId === template.id}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Empty State */}
      {filteredTemplates.length === 0 && (
        <div className="text-center py-12">
          <p className="text-foreground-muted">No templates found in this category.</p>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <TemplatePreview
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
