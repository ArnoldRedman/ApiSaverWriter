export interface Skill {
  id: number | string;
  name: string;
  /** 稳定路由键；内置技能的中文名称仅用于界面展示 */
  displayName?: string;
  category: string;
  description: string;
  tags: string[];
  rating: number;
  usageCount: number;
  content: string;
  builtin?: boolean;
}
