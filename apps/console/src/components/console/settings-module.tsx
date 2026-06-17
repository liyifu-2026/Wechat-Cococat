import { SettingsView, type SettingsCategoryId } from "@/components/settings/settings-view"
import type { SettingsGroup } from "@/lib/console-layout"

type SettingsModuleProps = {
  embedded?: boolean
  /** 锁定设置组（程序=cococat，高级·界面=system） */
  lockedGroup?: SettingsGroup
  hideHeader?: boolean
  forcedCategory?: SettingsCategoryId
  hideSidebar?: boolean
  hideGroupTabs?: boolean
}

/** Global settings — reachable from the main Console rail (any module). */
export function SettingsModule({
  embedded = false,
  lockedGroup,
  hideHeader = false,
  forcedCategory,
  hideSidebar = false,
  hideGroupTabs = false,
}: SettingsModuleProps = {}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SettingsView
        embedded={embedded}
        lockedGroup={lockedGroup}
        hideHeader={hideHeader}
        forcedCategory={forcedCategory}
        hideSidebar={hideSidebar}
        hideGroupTabs={hideGroupTabs}
      />
    </div>
  )
}
