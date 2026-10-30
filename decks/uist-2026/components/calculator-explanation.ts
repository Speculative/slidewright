import { STEPS } from './debugger-stages.js';

// Keep the slide-3 bug: exponentiation currently multiplies its operands.
export const calculatorCode = [
  'def evaluate(node):',
  '    if isinstance(node, Num):',
  '        return node.value',
  '    left = evaluate(node.left)',
  '    right = evaluate(node.right)',
  '    match node.op:',
  '        case "+": result = left + right',
  '        case "*": result = left * right',
  '        case "^": result = left * right',
  '    return result',
];
export const calculatorPrintCode = [
  ...calculatorCode.slice(0, -1),
  '    print(node.op)',
  calculatorCode.at(-1)!,
];
export const calculatorVariables = ['node', 'node.value', 'node.left', 'node.right', 'left', 'right', 'node.op', 'result'];
export const calculatorOperations = ['^', '*', '+'];
export const calculatorOutput = [
  ['>>> calculate("2 + 3 * 4 ^ 2")', ''],
  ['^', ''], ['*', ''], ['+', ''], ['', '26'],
];

// The ten axis-introduction stages, ending before breakpoint debugging.
export const calculatorStages = STEPS.slice(0, 10).map(stage => ({
  ...stage,
  stateVarLabelTargets: calculatorVariables.map((_, index) => ({
    x: stage.stateVarLabelTargets[0]!.x,
    y: stage.stateVarLabelTargets[0]!.opacity ? 90 + index / (calculatorVariables.length - 1) * 340 : 250,
    opacity: stage.stateVarLabelTargets[0]!.opacity,
  })),
  costLabelTargets: calculatorOperations.map((_, index) => ({
    x: stage.costLabelTargets[0]!.opacity ? 180 + index * 280 : 460,
    y: stage.costLabelTargets[0]!.opacity ? 330 : stage.costLabelTargets[0]!.y,
    rotate: stage.costLabelTargets[0]!.rotate,
    opacity: stage.costLabelTargets[0]!.opacity,
  })),
}));
