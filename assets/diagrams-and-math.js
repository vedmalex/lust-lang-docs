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

  var CALLOUT_SPECS = {
    note: {
      label: "Note",
      path: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
    },
    tip: {
      label: "Tip",
      path: "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
    },
    important: {
      label: "Important",
      path: "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
    },
    warning: {
      label: "Warning",
      path: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
    },
    caution: {
      label: "Caution",
      path: "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
    },
  };

  /**
   * Upgrades blockquotes whose first line uses `[!NOTE] Custom Title` (with trailing
   * title text that mdBook's native parser ignores) into `.blockquote-tag` callouts.
   */
  function enhanceCalloutBlockquotes(root) {
    var quotes = root.querySelectorAll("blockquote:not(.blockquote-tag)");
    for (var i = 0; i < quotes.length; i++) {
      var quote = quotes[i];
      var firstPara = quote.firstElementChild;
      if (!firstPara || firstPara.tagName !== "P") continue;
      var firstNode = firstPara.firstChild;
      if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) continue;

      var match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\r\n]*))?(?:\r?\n|$)/i.exec(
        firstNode.data,
      );
      if (!match) continue;

      var kind = match[1].toLowerCase();
      var spec = CALLOUT_SPECS[kind];
      if (!spec) continue;

      var customTitle = (match[2] || "").trim();
      firstNode.data = firstNode.data.slice(match[0].length);
      if (firstNode.data === "") firstNode.remove();
      while (firstPara.firstChild && firstPara.firstChild.tagName === "BR") {
        firstPara.firstChild.remove();
      }
      if (!firstPara.textContent.trim() && firstPara.children.length === 0) {
        firstPara.remove();
      }

      quote.classList.add("blockquote-tag", "blockquote-tag-" + kind);

      var titleP = document.createElement("p");
      titleP.className = "blockquote-tag-title";

      var svgNS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("width", "18");
      svg.setAttribute("height", "18");
      svg.setAttribute("aria-hidden", "true");
      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", spec.path);
      svg.appendChild(path);

      titleP.appendChild(svg);
      titleP.appendChild(document.createTextNode(customTitle || spec.label));
      quote.insertBefore(titleP, quote.firstChild);
    }
  }

  function runAll() {
    var root = document.querySelector("#mdbook-content main") || document.querySelector("main") || document.body;
    if (!root) return;
    enhanceCalloutBlockquotes(root);
    renderMermaidDiagrams(root);
    renderMathFormulas(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAll);
  } else {
    runAll();
  }
})();
