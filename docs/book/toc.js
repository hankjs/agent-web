// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><a href="overview.html"><strong aria-hidden="true">1.</strong> 概览</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/01_我为什么要做这门课，以及我是谁.html"><strong aria-hidden="true">2.</strong> Agent 开发基础</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="agent-fundamentals/02_搞定 Agent 六大支柱：今天出个 Manus 明天出个 OpenClaw，你到底应该学什么？.html"><strong aria-hidden="true">2.1.</strong> 搞定 Agent 六大支柱</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/03_从 ChatBot 到 Agent：一个 while 循环，凭什么让 AI 从_能聊天_变成_能干活_？.html"><strong aria-hidden="true">2.2.</strong> 从 ChatBot 到 Agent</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/04_做 Agent 开发，有些大模型本身的底层机制，你不得不了解.html"><strong aria-hidden="true">2.3.</strong> 大模型底层机制</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/05_2026 年了，你的 Agent 架构还停留在 LangChain 时代吗？.html"><strong aria-hidden="true">2.4.</strong> Agent 架构演进</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/06_你的 Agent 为什么_卡_半天才吐字？流式响应的工程真相.html"><strong aria-hidden="true">2.5.</strong> 流式响应的工程真相</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/07_模型 API 挂了怎么办？生产级容错不是加个 try-catch 这么简单.html"><strong aria-hidden="true">2.6.</strong> 生产级容错</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/08_死循环、重复犯错、Token 烧穿：你的 Agent Loop 缺这三个_保险丝_.html"><strong aria-hidden="true">2.7.</strong> Agent Loop 保险丝</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/09_Function Calling 与 Structured Output：模型是怎么_学会_调用你写的函数的？.html"><strong aria-hidden="true">2.8.</strong> Function Calling 与 Structured Output</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/10_一次工具调用背后经历了什么？以 Claude Code 为例展开聊聊.html"><strong aria-hidden="true">2.9.</strong> 工具调用全流程</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/11_工具太多模型选不准？Deferred Loading 和动态工具集.html"><strong aria-hidden="true">2.10.</strong> 动态工具集</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/12_MCP 的工程真相：协议很好，但也有一些硬伤.html"><strong aria-hidden="true">2.11.</strong> MCP 工程真相</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/13_Skills：Agent 时代的知识分发系统.html"><strong aria-hidden="true">2.12.</strong> Skills 知识分发系统</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/14_你敢让 AI 直接跑 rm -rf 吗？生产级权限系统的四层防线.html"><strong aria-hidden="true">2.13.</strong> 生产级权限系统</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/15_Context Engineering 全景：五个维度，一张地图.html"><strong aria-hidden="true">2.14.</strong> Context Engineering 全景</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/16_System Prompt 工程化与 Context Rot：从_写一段提示词_到_搭建一个行为控制系统_.html"><strong aria-hidden="true">2.15.</strong> System Prompt 工程化</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/17_上下文快爆了怎么办？深入来聊聊上下文压缩这件事.html"><strong aria-hidden="true">2.16.</strong> 上下文压缩</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/18_Cache 全解与成本控制：别再弄混 KV Cache、Prompt Cache、Context Collapse 这些.html"><strong aria-hidden="true">2.17.</strong> Cache 全解与成本控制</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/19_深入 Just-In-Time Context：上下文不是越早塞越好.html"><strong aria-hidden="true">2.18.</strong> Just-In-Time Context</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/20_RAG 全流程：从一堆文档到 Agent 能用的知识库.html"><strong aria-hidden="true">2.19.</strong> RAG 全流程</a></li><li class="chapter-item expanded "><a href="agent-fundamentals/21_检索优化：语义相似 ≠ 任务相关，怎么让 Agent 找到真正需要的信息？上新.html"><strong aria-hidden="true">2.20.</strong> 检索优化</a></li></ol></li><li class="chapter-item expanded "><a href="super-agent/01_10 分钟，让你的 AI 开口说话.html"><strong aria-hidden="true">3.</strong> Super Agent 实战</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="super-agent/02_从_能聊天_到_能干活_——给 Agent 装上 while 循环.html"><strong aria-hidden="true">3.1.</strong> 给 Agent 装上 while 循环</a></li><li class="chapter-item expanded "><a href="super-agent/03_Agent 不能这么脆——循环检测、API 容错与 Token 预算.html"><strong aria-hidden="true">3.2.</strong> 循环检测、容错与预算</a></li><li class="chapter-item expanded "><a href="super-agent/04_给 Agent 一双手——Tool 注册、执行、截断与并发.html"><strong aria-hidden="true">3.3.</strong> Tool 注册、执行与并发</a></li><li class="chapter-item expanded "><a href="super-agent/05_补齐装备——edit_file、grep、glob 与 bash.html"><strong aria-hidden="true">3.4.</strong> edit_file、grep、glob 与 bash</a></li><li class="chapter-item expanded "><a href="super-agent/06_小试牛刀——把工具组装成应用：代码分析、Research Agent、Vibe Coding.html"><strong aria-hidden="true">3.5.</strong> 工具组装成应用</a></li><li class="chapter-item expanded "><a href="super-agent/07_加餐：Agent 的 Search 工具究竟是如何来实现的？.html"><strong aria-hidden="true">3.6.</strong> Search 工具实现</a></li><li class="chapter-item expanded "><a href="super-agent/08_MCP 接入实战——给 Agent 接上 GitHub.html"><strong aria-hidden="true">3.7.</strong> MCP 接入实战</a></li><li class="chapter-item expanded "><a href="super-agent/09_工具太多模型选不准——实现 ToolSearch.html"><strong aria-hidden="true">3.8.</strong> 实现 ToolSearch</a></li><li class="chapter-item expanded "><a href="super-agent/10_Session 持久化 + Prompt Pipe——对话存档与模块化 Prompt 组装.html"><strong aria-hidden="true">3.9.</strong> Session 持久化与 Prompt Pipe</a></li><li class="chapter-item expanded "><a href="super-agent/11_对话太长了怎么办——Microcompact + LLM 摘要压缩.html"><strong aria-hidden="true">3.10.</strong> Microcompact 与摘要压缩</a></li><li class="chapter-item expanded "><a href="super-agent/12_三层即时防线——Token 估算、工具截断与 TTL 修剪.html"><strong aria-hidden="true">3.11.</strong> 三层即时防线</a></li><li class="chapter-item expanded "><a href="super-agent/13_让对话越来越便宜——Prompt Cache 与成本追踪.html"><strong aria-hidden="true">3.12.</strong> Prompt Cache 与成本追踪</a></li><li class="chapter-item expanded "><a href="super-agent/14_关掉终端再打开，Agent 还记得你是谁——持久化记忆系统.html"><strong aria-hidden="true">3.13.</strong> 持久化记忆系统</a></li><li class="chapter-item expanded "><a href="super-agent/15_RAG 实战——sqlite-vec + BM25 混合检索.html"><strong aria-hidden="true">3.14.</strong> RAG 混合检索实战</a></li><li class="chapter-item expanded "><a href="super-agent/16_记忆会变坏——给 Agent 的记忆库做体检.html"><strong aria-hidden="true">3.15.</strong> 记忆库体检</a></li><li class="chapter-item expanded "><a href="super-agent/17_Skills——给 Agent 注入领域知识.html"><strong aria-hidden="true">3.16.</strong> Skills 注入领域知识</a></li><li class="chapter-item expanded "><a href="super-agent/18_Plugin 架构——让别人给你的 Agent 写功能.html"><strong aria-hidden="true">3.17.</strong> Plugin 架构</a></li></ol></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
