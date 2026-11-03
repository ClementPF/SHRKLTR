package calc.property;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 *
 * @author danny
 */
@Component
@ConfigurationProperties(prefix = "calc.fb")
public class FacebookProperties {
    private String graphApiUri;
    private String userFields;

    public String getGraphApiUri() {
        return graphApiUri;
    }

    public void setGraphApiUri(String graphApiUri) {
        this.graphApiUri = graphApiUri;
    }

    public String getUserFields() {
        return userFields;
    }

    public void setUserFields(String userFields) {
        this.userFields = userFields;
    }
}
