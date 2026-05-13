基于以下 Explore 摘要生成 Spec 和 Task。

Change：{{change_name}}
工作目录：{{work_dir}}

Explore 摘要：
{{explore_summary}}

生成要求：
1. 只生成 Spec 和 Task。
2. Spec 要按 capability 拆分，每个 capability 内容必须能被开发者直接实现。
3. Task 要按执行顺序分组，粒度适合逐项完成和标记状态。
4. 完成后调用 generate_artifacts，参数只包含 specs 和 tasks。
