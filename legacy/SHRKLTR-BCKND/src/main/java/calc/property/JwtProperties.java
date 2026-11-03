package calc.property;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 *
 * @author danny
 */
@Component
@ConfigurationProperties(prefix = "calc.jwt")
public class JwtProperties {
    private String secret;
    private String iss;
    private Long tokenExpirationMinutes;
    private Long tokenRefreshExpirationMinutes;

    public String getSecret() {
        return secret;
    }

    public void setSecret(String secret) {
        this.secret = secret;
    }

    public String getIss() {
        return iss;
    }

    public void setIss(String iss) {
        this.iss = iss;
    }

    public Long getTokenExpirationMinutes() {
        return tokenExpirationMinutes;
    }

    public void setTokenExpirationMinutes(Long tokenExpirationMinutes) {
        this.tokenExpirationMinutes = tokenExpirationMinutes;
    }

    public Long getTokenRefreshExpirationMinutes() {
        return tokenRefreshExpirationMinutes;
    }

    public void setTokenRefreshExpirationMinutes(Long tokenRefreshExpirationMinutes) {
        this.tokenRefreshExpirationMinutes = tokenRefreshExpirationMinutes;
    }
}
