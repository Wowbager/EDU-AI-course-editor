/**
 * The only `fsrs.skip_condition` the app evaluates: `GPF_mastery <op> <number>`, any
 * case, `<op>` one of `>=` `<=` `==` `!=` `>` `<` (`skip_condition_evaluator.dart`,
 * `SkipConditionEvaluator._exprPattern`). Anything else is logged and never skips.
 */
const SKIP_CONDITION = /^\s*GPF_mastery\s*(>=|<=|==|!=|>|<)\s*([0-9]*\.?[0-9]+)\s*$/i;

export const skipConditionSupported = (condition: string): boolean =>
	SKIP_CONDITION.test(condition);
