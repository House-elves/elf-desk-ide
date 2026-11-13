import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory, bindViewContribution } from '@theia/core/lib/browser/index.js';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source.js';
import { ElfDeskMain, elfDeskMainPath } from '../common/elf-desk-protocol.js';
import { DeskContribution } from './desk-contribution.js';
import { DeskWidget } from './desk-widget.js';

export default new ContainerModule(bind => {
    bind(ElfDeskMain).toDynamicValue(ctx => ElectronIpcConnectionProvider.createProxy<ElfDeskMain>(ctx.container, elfDeskMainPath)).inSingletonScope();
    bind(DeskWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DeskWidget.ID,
        createWidget: () => ctx.container.get(DeskWidget)
    })).inSingletonScope();
    bindViewContribution(bind, DeskContribution);
    bind(FrontendApplicationContribution).toService(DeskContribution);
});
