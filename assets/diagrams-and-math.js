(function () {
  /**
   * Escapes literal `%` written right after non-whitespace text (e.g. `\text{100% Identical}`),
   * matching KaTeX's lexer rules so `%` is not treated as a TeX line comment.
   */
  function escapeLiteralPercents(tex) {
    var repaired = "";
    var copied = 0;
    var index = 0;
    while (index < tex.length) {
      var ch = tex[index];
      if (ch === "\\") {
        if (tex.indexOf("\\verb", index) === index) {
          var starred = tex[index + 5] === "*";
          var delimiter = tex[index + (starred ? 6 : 5)];
          if (delimiter !== undefined && (starred || !/[*a-zA-Z]/.test(delimiter))) {
            var bodyStart = index + (starred ? 7 : 6);
            var close = bodyStart;
            while (close < tex.length && tex[close] !== delimiter && tex[close] !== "\n" && tex[close] !== "\r") {
              close++;
            }
            if (tex[close] !== delimiter) return tex;
            index = close + 1;
            continue;
          }
        }
        index += 2;
      } else if (ch === "%" && index > 0 && !/\s/.test(tex[index - 1])) {
        repaired += tex.slice(copied, index) + "\\%";
        copied = ++index;
      } else if (ch === "%") {
        var newline = tex.indexOf("\n", index);
        index = newline === -1 ? tex.length : newline + 1;
      } else {
        index++;
      }
    }
    return copied === 0 ? tex : repaired + tex.slice(copied);
  }

  var diagramMathProbe = null;

  /**
   * Typesets `$$...$$` math labels inside Mermaid diagrams using KaTeX MathML output.
   */
  function resolveDiagramMath(tex, size) {
    if (!window.katex || typeof window.katex.renderToString !== "function") {
      return null;
    }
    try {
      if (!diagramMathProbe) {
        diagramMathProbe = document.createElement("div");
        diagramMathProbe.style.cssText =
          "position:absolute;left:-9999px;visibility:hidden;display:inline-block;white-space:nowrap";
        document.body.appendChild(diagramMathProbe);
      }
      diagramMathProbe.style.fontSize = size + "px";
      diagramMathProbe.innerHTML = window.katex.renderToString(escapeLiteralPercents(tex), {
        displayMode: true,
        output: "mathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 1000,
      });
      var mathEl = diagramMathProbe.querySelector("math");
      if (!mathEl) return null;
      var annotation = mathEl.querySelector("annotation");
      if (annotation) annotation.remove();
      var rect = mathEl.getBoundingClientRect();
      return { html: mathEl.outerHTML, width: rect.width, height: rect.height };
    } catch (_err) {
      return null;
    }
  }

  var activeDialog = null;
  var activeDialogMount = null;

  function closeExpandDialog() {
    if (activeDialogMount && typeof activeDialogMount.destroy === "function") {
      activeDialogMount.destroy();
      activeDialogMount = null;
    }
    if (activeDialog) {
      if (activeDialog.open) activeDialog.close();
      activeDialog.remove();
      activeDialog = null;
    }
  }

  function openExpandDialog(source) {
    if (!window.pele || typeof window.pele.mount !== "function") return;
    closeExpandDialog();

    var dialog = document.createElement("dialog");
    dialog.className = "lust-mermaid-dialog";
    dialog.setAttribute("aria-label", "Expanded Mermaid diagram");

    var header = document.createElement("div");
    header.className = "lust-mermaid-dialog-header";

    var title = document.createElement("span");
    title.textContent = "Diagram Preview (scroll or use controls to zoom, drag to pan)";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lust-mermaid-btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", closeExpandDialog);

    header.appendChild(title);
    header.appendChild(closeBtn);

    var canvas = document.createElement("div");
    canvas.className = "lust-mermaid-dialog-canvas";

    dialog.appendChild(header);
    dialog.appendChild(canvas);
    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) closeExpandDialog();
    });
    dialog.addEventListener("close", function () {
      if (activeDialogMount && typeof activeDialogMount.destroy === "function") {
        activeDialogMount.destroy();
        activeDialogMount = null;
      }
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
    });

    document.body.appendChild(dialog);
    activeDialog = dialog;
    dialog.showModal();

    activeDialogMount = window.pele.mount(canvas, source, {
      links: false,
      images: false,
      zoom: { always: true, controls: true, maxScale: 4 },
      autoDirection: false,
      math: resolveDiagramMath,
    });
  }

  function isMermaidCodeBlock(codeEl) {
    if (!codeEl || !codeEl.className) return false;
    var classes = String(codeEl.className).trim().split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      if (/^language-mermaid(?:$|[,;])/.test(classes[i])) {
        return true;
      }
    }
    return false;
  }

  function renderMermaidDiagrams(root) {
    if (!window.pele || typeof window.pele.mount !== "function") return;
    var codeBlocks = root.querySelectorAll('pre > code[class*="language-mermaid"]');
    for (var i = 0; i < codeBlocks.length; i++) {
      var codeEl = codeBlocks[i];
      if (!isMermaidCodeBlock(codeEl)) continue;
      var preEl = codeEl.parentElement;
      if (!preEl || preEl.getAttribute("data-lust-mermaid-processed") === "1") continue;
      preEl.setAttribute("data-lust-mermaid-processed", "1");

      var source = (codeEl.textContent || "").trim();
      if (!source) continue;

      var wrapper = document.createElement("div");
      wrapper.className = "lust-mermaid-block";

      var actions = document.createElement("div");
      actions.className = "lust-mermaid-actions";

      var sourceBtn = document.createElement("button");
      sourceBtn.type = "button";
      sourceBtn.className = "lust-mermaid-btn";
      sourceBtn.textContent = "Source";
      sourceBtn.setAttribute("aria-expanded", "false");

      var expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "lust-mermaid-btn";
      expandBtn.textContent = "Expand";

      actions.appendChild(sourceBtn);
      actions.appendChild(expandBtn);

      var canvas = document.createElement("div");
      canvas.className = "lust-mermaid-canvas";

      var errorNotice = document.createElement("p");
      errorNotice.className = "lust-mermaid-error";
      errorNotice.hidden = true;

      var sourcePre = document.createElement("pre");
      sourcePre.className = "lust-mermaid-source";
      sourcePre.hidden = true;
      var sourceCode = document.createElement("code");
      sourceCode.className = "language-mermaid";
      sourceCode.textContent = source;
      sourcePre.appendChild(sourceCode);

      (function (src, srcBtn, expBtn, srcBlock, errBox, canvasEl) {
        srcBtn.addEventListener("click", function () {
          var nextHidden = !srcBlock.hidden;
          srcBlock.hidden = nextHidden;
          srcBtn.setAttribute("aria-expanded", String(!nextHidden));
          srcBtn.textContent = nextHidden ? "Source" : "Hide source";
        });

        expBtn.addEventListener("click", function () {
          openExpandDialog(src);
        });

        window.pele.mount(canvasEl, src, {
          links: false,
          images: false,
          zoom: false,
          autoDirection: false,
          math: resolveDiagramMath,
          onRender: function () {
            errBox.hidden = true;
          },
          onError: function (err) {
            errBox.textContent =
              "Unable to render diagram: " + (err instanceof Error ? err.message : String(err));
            errBox.hidden = false;
            srcBlock.hidden = false;
            srcBtn.hidden = true;
            expBtn.hidden = true;
          },
        });
      })(source, sourceBtn, expandBtn, sourcePre, errorNotice, canvas);

      wrapper.appendChild(actions);
      wrapper.appendChild(errorNotice);
      wrapper.appendChild(canvas);
      wrapper.appendChild(sourcePre);

      preEl.parentNode.replaceChild(wrapper, preEl);
    }
  }

  function renderMathFormulas(root) {
    if (typeof window.renderMathInElement !== "function") return;
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      preProcess: escapeLiteralPercents,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 1000,
    });
  }

  function runAll() {
    var root = document.querySelector("#mdbook-content main") || document.querySelector("main") || document.body;
    if (!root) return;
    renderMermaidDiagrams(root);
    renderMathFormulas(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAll);
  } else {
    runAll();
  }
})();
