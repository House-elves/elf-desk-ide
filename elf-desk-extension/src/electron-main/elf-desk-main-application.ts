import { injectable } from '@theia/core/shared/inversify';
import { session as electronSession, WebContents } from '@theia/electron/shared/electron';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application.js';
import { ElfDeskMainImpl } from './elf-desk-main-impl.js';

/**
 * Theia stops every page in the app from navigating, which is right for its own window. The desk's view is a web
 * site that navigates (signing in ends with a redirect), and has guards of its own (ElfDeskMainImpl keeps it on the
 * desk), so Theia's are left off there.
 */
@injectable()
export class ElfDeskMainApplication extends ElectronMainApplication {
    protected override onWebContentsCreated(event: Electron.Event, webContents: WebContents): void {
        if (webContents.session === electronSession.fromPartition(ElfDeskMainImpl.PARTITION)) return;
        super.onWebContentsCreated(event, webContents);
    }
}
