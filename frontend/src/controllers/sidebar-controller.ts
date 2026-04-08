export type SidebarController = {
    showLibrary: () => void;
    showSocial: () => void;
    isSocialActive: () => boolean;
};

export const createSidebarController = (controller: SidebarController): SidebarController => ({
    showLibrary: () => {
        controller.showLibrary();
    },
    showSocial: () => {
        controller.showSocial();
    },
    isSocialActive: () => controller.isSocialActive(),
});
