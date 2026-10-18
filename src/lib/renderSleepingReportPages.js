// Paginate DOM by whole table rows, repeating the report heading and table header.
export default async function renderSleepingReportPages(html) {
  await document.fonts.ready;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:794px;pointer-events:none";
  host.innerHTML = html;
  document.body.appendChild(host);
  const source = host.firstElementChild, elements = [];
  const style = source.querySelector("style");
  const blocks = [...source.children].filter(n => n.tagName !== "STYLE");
  const heading = blocks[0], footer = blocks[blocks.length - 1];
  let body;
  const newPage = () => {
    const page = source.cloneNode(false);
    page.style.height = "1123px"; page.style.position = "relative";
    page.appendChild(style.cloneNode(true));
    body = document.createElement("div");
    body.style.cssText = "height:995px;overflow:hidden";
    body.appendChild(heading.cloneNode(true)); page.appendChild(body);
    const foot = footer.cloneNode(true);
    foot.style.cssText = "position:absolute;bottom:24px;left:44px;right:44px;font-size:10px;color:#555";
    foot.textContent += ` · עמוד ${elements.length + 1}`;
    page.appendChild(foot); host.appendChild(page); elements.push(page);
  };
  newPage();
  for (const block of blocks.slice(1, -1)) {
    if (block.tagName !== "TABLE") {
      const node = block.cloneNode(true); body.appendChild(node);
      if (body.scrollHeight > body.clientHeight) { node.remove(); newPage(); body.appendChild(node); }
      continue;
    }
    let table, tbody;
    const newTable = () => {
      table = block.cloneNode(false); table.appendChild(block.tHead.cloneNode(true));
      tbody = document.createElement("tbody"); table.appendChild(tbody); body.appendChild(table);
    };
    newTable();
    for (const row of block.tBodies[0].rows) {
      const node = row.cloneNode(true); tbody.appendChild(node);
      if (body.scrollHeight > body.clientHeight) { node.remove(); if (!tbody.rows.length) table.remove(); newPage(); newTable(); tbody.appendChild(node); }
    }
  }
  source.remove();
  return { elements, remove: () => host.remove() };
}