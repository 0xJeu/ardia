import { Globe } from "lucide-react";
import { faviconFor } from "../../pages";

export function RefusedPage({ host }: { host: string }) {
  const favicon = faviconFor(`https://${host}/`);
  return (
    <div className="ardia-refused">
      <div className="ardia-refused-card">
        <div className="ardia-refused-site">
          {favicon ? <img src={favicon} alt="" width={16} height={16} /> : <Globe size={15} strokeWidth={1.75} />}
          <span>{host}</span>
        </div>
        <h1>This one opens in Ardia, not in a demo.</h1>
        <p>{host} won't load inside another web page. In Ardia it's just a tab, like any other.</p>
        <a className="ardia-refused-download" href="https://ardia.dev" target="_blank" rel="noopener">
          Download Ardia
        </a>
        <span className="ardia-refused-note">Free and open source, for Apple Silicon Macs.</span>
      </div>
    </div>
  );
}
