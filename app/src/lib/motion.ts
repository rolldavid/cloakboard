import type { Variants, Transition } from 'framer-motion';

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export const slideIn: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export const buttonPress = {
  whileTap: { scale: 0.97 },
  whileHover: { scale: 1.02 },
  transition: { type: 'spring', stiffness: 400, damping: 17 } as Transition,
};

export const hoverLift = {
  initial: 'initial' as const,
  whileHover: { y: -2, transition: { duration: 0.2 } },
};

export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

/** Wizard step slide — direction controlled by custom prop */
export const wizardStepVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 24 : -24,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -24 : 24,
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeIn' },
  }),
};

/** Modal backdrop fade */
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Modal content scale + fade */
export const modalContentVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.15 } },
};

/** Content crossfade for tab switches and skeleton→content */
export const contentFade: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

/** Badge pop animation */
export const badgePop: Variants = {
  initial: { scale: 0.5, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 500, damping: 20 } },
  exit: { scale: 0.5, opacity: 0, transition: { duration: 0.1 } },
};

/** Spring transition for progress bars */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
};
