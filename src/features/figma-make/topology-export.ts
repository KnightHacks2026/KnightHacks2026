/** Export the rendered topology, including its current viewBox and selection. */
export function downloadTopologySvg(source: SVGSVGElement): void {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...Array.from(source.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor"];
  originals.forEach((element, index) => {
    const styles = getComputedStyle(element);
    const target = copies[index] as SVGElement;
    for (const property of properties) target.style.setProperty(property, styles.getPropertyValue(property));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "960");
  clone.setAttribute("height", "550");
  const viewBox = source.viewBox.baseVal;
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("x", String(viewBox.x));
  background.setAttribute("y", String(viewBox.y));
  background.setAttribute("width", String(viewBox.width));
  background.setAttribute("height", String(viewBox.height));
  background.setAttribute("fill", "#0c1511");
  clone.insertBefore(background, clone.firstChild);
  const content = new XMLSerializer().serializeToString(clone);
  if (!content.includes("network-node") || !content.includes("<path")) throw new Error("The topology is incomplete.");
  const url = URL.createObjectURL(new Blob([content], { type: "image/svg+xml;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "custodyos-topology.svg";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
