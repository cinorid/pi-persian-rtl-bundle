import { applyAll } from '../lib/patch.cjs';

/**
 * Applied at pi startup.
 *
 * The patch targets the runtime bundle on disk, so it only takes effect after
 * a restart. This mirrors how the upstream pi-persian-rtl extension behaves,
 * but it patches the file Pi actually executes.
 */
export default function () {
  let result;
  try {
    result = applyAll();
  } catch (error) {
    console.warn(`[pi-persian-rtl-bundle] ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (result.errors.length > 0) {
    const detail = result.errors
      .map((entry) => `${entry.file ?? entry.dir}: ${entry.error}`)
      .join('; ');
    console.warn(`[pi-persian-rtl-bundle] ${detail}`);
    return;
  }

  if (result.results.length === 0) {
    console.warn('[pi-persian-rtl-bundle] Could not locate the Pi runtime bundle. Run `pi-persian-rtl-bundle doctor`.');
    return;
  }

  if (result.patched)
    console.warn('[pi-persian-rtl-bundle] Persian/RTL patch applied to the runtime bundle. Restart pi to use it.');
}
