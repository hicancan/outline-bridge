export const PROMPT_TEMPLATE = `你将收到一本书的一张或多张目录页图片。

你的任务不是总结内容，而是把印刷版目录严格提取为 JSON。

要求：
1. 按目录自然阅读顺序识别：每页先左栏从上到下，再右栏从上到下。
2. 忽略点线引导符，例如“..............”，不要把它们写进 title。
3. 如果一个目录项跨两行显示，必须合并为一个完整标题。
4. 根据编号和缩进推断层级：
   - level=1：章标题，例如“第1章 程序设计：综述”
   - level=2：节标题，例如“1.2 数学知识复习”
   - level=3：小节标题，例如“1.2.1 指数(exponent)”
   - “小结”“练习”“参考文献”统一记为 level=2，并归到当前章下
5. page_label 必须保留书中印刷页码原样，并且是字符串。
6. title 里不要包含页码。
7. 如果某一项看不清，不要猜：
   - 可以标记 uncertain=true
   - 或放进 uncertain_entries
8. 尽量忠实保留中文、英文、标点、括号和空格。
9. 最终只输出一个 \`\`\`json 代码围栏，不要输出任何解释。

JSON 格式：
{
  "entries": [
    {
      "order": 1,
      "toc_image_index": 1,
      "level": 1,
      "title": "第1章 程序设计：综述",
      "page_label": "1",
      "uncertain": false
    }
  ],
  "uncertain_entries": [
    {
      "toc_image_index": 1,
      "raw_text": "无法可靠识别的条目",
      "reason": "too_blurry_or_broken"
    }
  ]
}

规则：
- order 必须在全部图片范围内从 1 开始连续递增。
- toc_image_index 从 1 开始编号。
- 如果不确定，宁可放进 uncertain_entries，也不要猜测或臆造。
- 只在一个 json 代码围栏里返回合法 JSON。`
