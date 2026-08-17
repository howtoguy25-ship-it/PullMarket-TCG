import ExpoModulesCore

public class AudioRoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioRoutePicker")

    View(AudioRoutePickerView.self) {
      Prop("tintColor") { (view: AudioRoutePickerView, color: UIColor?) in
        view.setTintColor(color)
      }
      Prop("activeTintColor") { (view: AudioRoutePickerView, color: UIColor?) in
        view.setActiveTintColor(color)
      }
    }
  }
}
