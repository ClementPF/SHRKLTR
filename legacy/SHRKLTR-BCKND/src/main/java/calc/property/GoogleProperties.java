package calc.property;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 *
 * @author danny
 */
@Component
@ConfigurationProperties(prefix = "calc.google")
public class GoogleProperties {

    private String iosClientId;
    private String androidClientId;
    private String iosStandaloneClientId;
    private String androidStandaloneClientId;

    public String getIosClientId() {
        return iosClientId;
    }

    public void setIosClientId(String iosClientId) {
        this.iosClientId = iosClientId;
    }

    public String getAndroidClientId() {
        return androidClientId;
    }

    public void setAndroidClientId(String androidClientId) {
        this.androidClientId = androidClientId;
    }

    public String getIosStandaloneClientId() {
        return iosStandaloneClientId;
    }

    public void setIosStandaloneClientId(String iosStandaloneClientId) {
        this.iosStandaloneClientId = iosStandaloneClientId;
    }

    public String getAndroidStandaloneClientId() {
        return androidStandaloneClientId;
    }

    public void setAndroidStandaloneClientId(String androidStandaloneClientId) {
        this.androidStandaloneClientId = androidStandaloneClientId;
    }
}
