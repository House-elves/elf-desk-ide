import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, Message, codicon } from '@theia/core/lib/browser/index.js';
import { ElfDeskMain } from '../common/elf-desk-protocol.js';

/**
 * The Desk panel. It holds no page of its own: the desk is a separate Electron view that the main process lays over
 * this panel's place in the window, and hides when the panel isn't showing.
 */
@injectable()
export class DeskWidget extends BaseWidget {

    static readonly ID = 'elf-desk';
    static readonly LABEL = 'Desk';

    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;

    protected timer: number | undefined;
    protected last = '';

    @postConstruct()
    protected init(): void {
        this.id = DeskWidget.ID;
        this.title.label = DeskWidget.LABEL;
        this.title.caption = 'Elf Desk';
        this.title.iconClass = codicon('home');
        this.title.closable = true;
        this.addClass('elf-desk-panel');
        this.node.tabIndex = 0;
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.track();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        if (this.isVisible) this.track();
    }

    protected override onBeforeHide(msg: Message): void {
        this.untrack();
        super.onBeforeHide(msg);
    }

    protected override onBeforeDetach(msg: Message): void {
        this.untrack();
        super.onBeforeDetach(msg);
    }

    override dispose(): void {
        this.untrack();
        super.dispose();
    }

    reload(): void {
        this.main.reload();
    }

    /**
     * Follows the panel while it shows. Panels move without resizing (a side bar opens), so a ResizeObserver isn't
     * enough: its place is checked each frame, and only a change goes to the main process.
     */
    protected track(): void {
        if (this.timer !== undefined) return;
        this.last = '';
        const tick = () => {
            const r = this.node.getBoundingClientRect();
            const key = `${r.x},${r.y},${r.width},${r.height}`;
            if (key !== this.last) {
                this.last = key;
                if (r.width > 0 && r.height > 0) this.main.show({ x: r.x, y: r.y, width: r.width, height: r.height });
                else this.main.hide();
            }
            this.timer = window.requestAnimationFrame(tick);
        };
        tick();
    }

    protected untrack(): void {
        if (this.timer !== undefined) window.cancelAnimationFrame(this.timer);
        this.timer = undefined;
        this.last = '';
        this.main.hide();
    }
}
