/**
 * Password Service
 *
 * Email validation and password strength checking.
 * Fully client-side — no server calls.
 */

export class PasswordService {
  static readonly MIN_LENGTH = 10;

  /**
   * Validate email format
   */
  static validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Check password strength (0-4 score)
   */
  static checkStrength(password: string): { score: number; feedback: string } {
    let score = 0;
    if (password.length >= 10) score++;
    if (password.length >= 14) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    score = Math.min(score, 4);

    let feedback = '';
    if (password.length < 10) feedback = 'Must be at least 10 characters';
    else if (score < 2) feedback = 'Add uppercase, numbers, or symbols';
    else if (score < 3) feedback = 'Good — could be stronger';
    return { score, feedback };
  }

  /**
   * Check if password meets minimum strength requirements
   */
  static isStrongEnough(password: string): boolean {
    return password.length >= this.MIN_LENGTH && this.checkStrength(password).score >= 2;
  }
}
