import { FragmenterInstaller, FragmenterInstallerEvents } from "@flybywiresim/fragmenter";
import channels from "common/channels";
import { ipcMain, WebContents } from "electron";

let lastProgressSent = 0;

export class InstallManager {
    static async install(
        sender: WebContents,
        ourInstallID: number,
        url: string,
        tempDir: string,
        destDir: string,
    ): Promise<boolean | Error> {
        const abortController = new AbortController();

        const fragmenterInstaller = new FragmenterInstaller(url, destDir, abortController.signal, { temporaryDirectory: tempDir, maxModuleRetries: 1 });

        const forwardFragmenterEvent = (event: keyof FragmenterInstallerEvents) => {
            fragmenterInstaller.on(event, (...args: unknown[]) => {
                if (event === 'downloadProgress') {
                    const currentTime = performance.now();
                    const timeSinceLastProgress = currentTime - lastProgressSent;

                    if (timeSinceLastProgress > 50) {
                        sender.send(channels.installManager.fragmenterEvent, ourInstallID, event, ...args);

                        lastProgressSent = currentTime;
                    }
                } else {
                    sender.send(channels.installManager.fragmenterEvent, ourInstallID, event, ...args);
                }
            });
        };

        const handleCancelInstall = (_: unknown, installID: number) => {
            if (installID !== ourInstallID) {
                return;
            }

            abortController.abort();
        };

        // Setup cancel event listener
        ipcMain.on(channels.installManager.cancelInstall, handleCancelInstall);

        forwardFragmenterEvent('error');
        forwardFragmenterEvent('downloadStarted');
        forwardFragmenterEvent('downloadProgress');
        forwardFragmenterEvent('downloadFinished');
        forwardFragmenterEvent('unzipStarted');
        forwardFragmenterEvent('unzipFinished');
        forwardFragmenterEvent('copyStarted');
        forwardFragmenterEvent('copyFinished');
        forwardFragmenterEvent('retryScheduled');
        forwardFragmenterEvent('retryStarted');
        forwardFragmenterEvent('fullDownload');
        forwardFragmenterEvent('logInfo');
        forwardFragmenterEvent('logWarn');
        forwardFragmenterEvent('logError');

        let ret = false;

        try {
            await fragmenterInstaller.install();

            ret = true;
        } catch (e) {
            if (e.message.startsWith('FragmenterError')) {
                ret = e;
            } else {
                throw e;
            }
        }

        // Tear down cancel event listener
        ipcMain.removeListener(channels.installManager.cancelInstall, handleCancelInstall);

        return ret;
    }

    static setupIpcListeners(): void {
        ipcMain.handle(channels.installManager.installFromUrl, async (event, installID: number, url: string, tempDir: string, destDir: string) => {
            return InstallManager.install(event.sender, installID, url, tempDir, destDir);
        });
    }
}
