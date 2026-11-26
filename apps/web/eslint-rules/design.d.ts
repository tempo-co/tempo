import type {Rule} from 'eslint';

declare const plugin: {rules: {tokens: Rule.RuleModule; exceptions: Rule.RuleModule}};
export default plugin;
