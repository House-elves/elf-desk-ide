import { ContainerModule } from '@theia/core/shared/inversify';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory.js';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler.js';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application.js';
import { ElfDeskMain, elfDeskMainPath } from '../common/elf-desk-protocol.js';
import { ElfDeskMainImpl } from './elf-desk-main-impl.js';
import { ElfDeskMainApplication } from './elf-desk-main-application.js';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(ElfDeskMainApplication).inSingletonScope();
    bind(ElfDeskMainImpl).toSelf().inSingletonScope();
    bind(ElfDeskMain).toService(ElfDeskMainImpl);
    bind(ElectronMainApplicationContribution).toService(ElfDeskMainImpl);
    bind(ElectronConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(elfDeskMainPath, () => ctx.container.get(ElfDeskMain))
    ).inSingletonScope();
});
