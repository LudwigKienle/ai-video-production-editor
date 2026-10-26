/**
 * Side-effect registration of the colour node effect for the Color page.
 * The coordinator adds the same `registerFx(PRIMARY_GRADE)` to
 * src/fx/registry.ts; registering twice is harmless (same id, same object).
 */
import { getFxDefinition, registerFx } from '../../fx/registry.ts';
import { PRIMARY_GRADE } from '../../fx/effects/primaryGrade/index.ts';

if (!getFxDefinition(PRIMARY_GRADE.id)) registerFx(PRIMARY_GRADE);

export { PRIMARY_GRADE };
