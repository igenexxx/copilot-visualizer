import type { VisualizerEvent } from '../types';

export type BlastSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface PackageHeatmap {
  packageName: string;
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  totalModifications: number;
}

export interface BlastRadiusTelemetry {
  totalFilesTouched: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  severity: BlastSeverity;
  packages: PackageHeatmap[];
  recentTouchedFiles: string[];
}

export class BlastRadiusEngine {
  private fileModifications: Map<string, { added: number; removed: number }> = new Map();
  private recentFiles: string[] = [];

  public reset(): void {
    this.fileModifications.clear();
    this.recentFiles = [];
  }

  public extractPackageName(filePath: string): string {
    if (!filePath) return 'root';
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = normalized.split('/');

    if (parts.length <= 1) return 'root';
    if (parts[0] === 'pkg' && parts.length >= 2) return `pkg/${parts[1]}`;
    if (parts[0] === 'web' && parts.length >= 3) return `web/${parts[1]}/${parts[2]}`;
    return parts[0];
  }

  public processEvent(event: VisualizerEvent): BlastRadiusTelemetry {
    if (event.type === 'file.write' || event.type === 'patch.apply' || event.type === 'code.forge') {
      const rawFile = event.payload?.file || event.payload?.TargetFile || event.title || '';
      const filePath = String(rawFile).trim();

      if (filePath) {
        const added = (event.payload?.added as number) || 12;
        const removed = (event.payload?.removed as number) || 2;

        const current = this.fileModifications.get(filePath) || { added: 0, removed: 0 };
        this.fileModifications.set(filePath, {
          added: current.added + added,
          removed: current.removed + removed,
        });

        if (!this.recentFiles.includes(filePath)) {
          this.recentFiles.unshift(filePath);
          if (this.recentFiles.length > 20) {
            this.recentFiles.pop();
          }
        }
      }
    }

    return this.getTelemetry();
  }

  public getTelemetry(): BlastRadiusTelemetry {
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    const pkgMap = new Map<string, PackageHeatmap>();

    for (const [filePath, stats] of this.fileModifications.entries()) {
      totalLinesAdded += stats.added;
      totalLinesRemoved += stats.removed;

      const pkgName = this.extractPackageName(filePath);
      const pkg = pkgMap.get(pkgName) || {
        packageName: pkgName,
        filesTouched: 0,
        linesAdded: 0,
        linesRemoved: 0,
        totalModifications: 0,
      };

      pkg.filesTouched++;
      pkg.linesAdded += stats.added;
      pkg.linesRemoved += stats.removed;
      pkg.totalModifications += stats.added + stats.removed;
      pkgMap.set(pkgName, pkg);
    }

    const totalFilesTouched = this.fileModifications.size;
    const totalLines = totalLinesAdded + totalLinesRemoved;

    let severity: BlastSeverity = 'LOW';
    if (totalLines > 500 || totalFilesTouched > 12) severity = 'EXTREME';
    else if (totalLines > 100 || totalFilesTouched > 5) severity = 'HIGH';
    else if (totalLines > 20 || totalFilesTouched > 2) severity = 'MEDIUM';

    const packages = Array.from(pkgMap.values()).sort((a, b) => b.totalModifications - a.totalModifications);

    return {
      totalFilesTouched,
      totalLinesAdded,
      totalLinesRemoved,
      severity,
      packages,
      recentTouchedFiles: [...this.recentFiles],
    };
  }
}
