/**
 * utils.ts — Shared frontend helpers.
 *
 * Small pure utilities used across components (className joining, number/percent
 * formatting, failure-stage color mapping, etc.).
 *
 * Stub: add helpers as needed.
 */

/** Join truthy class names into a single string. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
