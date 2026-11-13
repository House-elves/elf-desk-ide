import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, KeybindingContribution, WidgetFactory, bindViewContribution } from '@theia/core/lib/browser/index.js';
import { CommandContribution } from '@theia/core/lib/common/index.js';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source.js';
import { ElfDeskMain, elfDeskMainPath } from '../common/elf-desk-protocol.js';
import { DeskContribution } from './desk-contribution.js';
import { DeskPageOptions, DeskPageWidget } from './desk-widget.js';
import { ElvesContribution } from './elves-contribution.js';
import { ElvesModel } from './elves-model.js';
import { ElvesViewWidget } from './elves-view.js';
import '../../src/browser/style/elves.css';

export default new ContainerModule(bind => {
    bind(ElvesModel).toSelf().inSingletonScope();
    bind(ElfDeskMain).toDynamicValue(ctx =>
        ElectronIpcConnectionProvider.createProxy<ElfDeskMain>(ctx.container, elfDeskMainPath, ctx.container.get(ElvesModel))
    ).inSingletonScope();

    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DeskPageWidget.FACTORY,
        createWidget: (options: DeskPageOptions) => {
            const child = ctx.container.createChild();
            child.bind(DeskPageOptions).toConstantValue(options);
            child.bind(DeskPageWidget).toSelf();
            return child.get(DeskPageWidget);
        }
    })).inSingletonScope();

    bind(ElvesViewWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ElvesViewWidget.ID,
        createWidget: () => ctx.container.get(ElvesViewWidget)
    })).inSingletonScope();
    bindViewContribution(bind, ElvesContribution);
    bind(FrontendApplicationContribution).toService(ElvesContribution);

    bind(DeskContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DeskContribution);
    bind(KeybindingContribution).toService(DeskContribution);
    bind(FrontendApplicationContribution).toService(DeskContribution);
});
