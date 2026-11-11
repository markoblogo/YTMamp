import AppKit
import CoreLocation

// One foreground, permission-respecting request. No IP lookup or background tracking.
final class LocationRequest: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    var finished = false
    var resolving = false
    var geocoder: CLGeocoder?
    func finish(_ payload: [String: Any]) {
        guard !finished else { return }
        finished = true
        manager.stopUpdatingLocation()
        geocoder?.cancelGeocode()
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            FileHandle.standardOutput.write(data)
        }
        exit(0)
    }
    func start() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { self.finish(["error": "Location timed out. Check Location Services and try again."]) }
        authorize()
    }
    func authorize() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: manager.startUpdatingLocation()
        case .denied, .restricted: finish(["error": "Allow YTMamp in System Settings > Privacy & Security > Location Services, then try again.", "denied": true])
        @unknown default: finish(["error": "Location Services are unavailable."])
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { authorize() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code != .locationUnknown { finish(["error": "macOS could not determine the device location. Check Location Services and try again."]) }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !resolving, let location = locations.last, location.horizontalAccuracy >= 0, abs(location.timestamp.timeIntervalSinceNow) < 300 else { return }
        resolving = true
        manager.stopUpdatingLocation()
        let lat = (location.coordinate.latitude * 100).rounded() / 100
        let lon = (location.coordinate.longitude * 100).rounded() / 100
        let fallback: [String: Any] = ["lat": lat, "lon": lon, "label": "Device location", "countrycode": ""]
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.finish(fallback) }
        let lookup = CLGeocoder(); geocoder = lookup
        lookup.reverseGeocodeLocation(location) { places, _ in
            let place = places?.first
            self.finish(["lat": lat, "lon": lon, "label": place?.locality ?? "Device location", "countrycode": place?.isoCountryCode ?? ""])
        }
    }
}
if CommandLine.arguments.contains("--check") { print("YTMAMP_CORE_LOCATION_READY"); exit(0) }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.activate(ignoringOtherApps: true)
let request = LocationRequest()
DispatchQueue.main.async { request.start() }
application.run()
