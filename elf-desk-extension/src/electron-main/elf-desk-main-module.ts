import * as fs from 'fs';
import * as path from 'path';
import { app } from '@theia/electron/shared/electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory.js';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler.js';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application.js';
import { ElfDeskClient, ElfDeskMain, elfDeskMainPath } from '../common/elf-desk-protocol.js';
import { ElfDeskMainImpl } from './elf-desk-main-impl.js';
import { ElfDeskMainApplication } from './elf-desk-main-application.js';

// The bundled VS Code extensions (git): next to the app once packaged, in the repo's plugins/ when run from source.
// The backend is started from here, so it gets this too.
if (!process.env.THEIA_DEFAULT_PLUGINS) {
    const dir = [path.join(app.getAppPath(), 'plugins'), path.join(app.getAppPath(), '..', 'plugins')].find(d => fs.existsSync(d));
    if (dir) process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${dir}`;
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(ElfDeskMainApplication).inSingletonScope();
    bind(ElfDeskMainImpl).toSelf().inSingletonScope();
    bind(ElfDeskMain).toService(ElfDeskMainImpl);
    bind(ElectronMainApplicationContribution).toService(ElfDeskMainImpl);
    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler<ElfDeskClient>(elfDeskMainPath, client => {
            const main = ctx.container.get(ElfDeskMainImpl);
            main.addClient(client);
            client.onDidCloseConnection(() => main.removeClient(client));
            return main;
        })
    ).inSingletonScope();
});
