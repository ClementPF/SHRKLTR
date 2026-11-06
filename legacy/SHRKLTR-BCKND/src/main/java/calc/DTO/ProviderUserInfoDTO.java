package calc.DTO;

import java.util.Map;

/**
 *
 * @author danny
 */
public class ProviderUserInfoDTO {
    private String id;
    private String name;
    private String username;
    private String email;
    private String provider;
    private String pictureUrl;
    private Map picture;
    private String locale;

    public ProviderUserInfoDTO() {
    }

    public ProviderUserInfoDTO(String id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }
    
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getUsername() { return username; }

    public void setUsername(String username) { this.username = username; }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getPictureUrl() {
        return pictureUrl;
    }

    public void setPictureUrl(String picture) {
        this.pictureUrl = picture;
    }

    public String getLocale() {
        return locale;
    }

    public void setLocale(String locale) {
        this.locale = locale;
    }

    public Map getPicture() {
        return picture;
    }

    public void setPicture(Map picture) {
        this.picture = picture;
        if(picture != null){
            Map data = (Map) picture.get("data");
            if(data != null)
                pictureUrl = (String) data.get("url");
        }
    }
}
