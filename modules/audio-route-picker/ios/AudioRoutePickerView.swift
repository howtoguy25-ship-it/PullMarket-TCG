import ExpoModulesCore
import AVKit

// Wraps Apple's real AVRoutePickerView — the same system control FaceTime
// and the Phone app use. Tapping it opens iOS's native audio route menu
// (Speaker / iPhone / any connected Bluetooth device) and switches the
// active AVAudioSession route itself; this view never needs to know what
// route is chosen; iOS handles the actual audio routing.
class AudioRoutePickerView: ExpoView {
  private let routePickerView = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    routePickerView.translatesAutoresizingMaskIntoConstraints = false
    routePickerView.backgroundColor = .clear
    addSubview(routePickerView)
    NSLayoutConstraint.activate([
      routePickerView.leadingAnchor.constraint(equalTo: leadingAnchor),
      routePickerView.trailingAnchor.constraint(equalTo: trailingAnchor),
      routePickerView.topAnchor.constraint(equalTo: topAnchor),
      routePickerView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  func setTintColor(_ color: UIColor?) {
    routePickerView.tintColor = color
  }

  func setActiveTintColor(_ color: UIColor?) {
    routePickerView.activeTintColor = color
  }
}
