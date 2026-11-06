package calc.service;

import calc.DTO.UserDTO;
import calc.entity.User;
import calc.repository.UserRepository;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.text.ParseException;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Created by clementperez on 27/08/18.
 */

@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class UserServiceTest {

    @Autowired
    private UserService userService;

    @Autowired
    private UserRepository userRepository;

    List<User> allUsers ;

    @Before
    public void setUp() {

        allUsers = new ArrayList<>();

        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
        allUsers.add(userRepository.save(makeRandomUser()));
    }

    @Test
    public void testFindAll(){
        //assertThat(userRepository.findAll()).containsAll(allUsers);
    }

    @Test
    public void testFindOne(){
        UserDTO uTest = userService.convertToDto(allUsers.get(new Random().nextInt(allUsers.size() - 1)));
        UserDTO uFetch = userService.findOne(uTest.getUserId());
        assertThat(uFetch).isEqualToComparingFieldByField(uTest);
    }

    //@Test
    // find a way to make whosloggedIn work in test
    public void testSave(){
        UserDTO uTest = makeRandomUserDTO();
        UserDTO uFetch = userService.update(uTest);
        assertThat(uFetch).isEqualToComparingFieldByField(uTest);
    }

    @Test
    public void testWhoIsLoggedIn(){

    }

    @Test
    public void testWhoIsLoggedInEntity(){

    }

    @Test
    public void testFindByUserName(){
        UserDTO uTest = userService.convertToDto(allUsers.get(new Random().nextInt(allUsers.size() - 1)));
        UserDTO uFetch = userService.findByUserName(uTest.getUsername());
        assertThat(uFetch).isEqualToComparingFieldByField(uTest);
    }

    @Test
    public void testFindByUserId(){
        UserDTO uTest = userService.convertToDto(allUsers.get(new Random().nextInt(allUsers.size() - 1)));
        UserDTO uFetch = userService.findByUserId(uTest.getUserId());
        assertThat(uFetch).isEqualToComparingFieldByField(uTest);
    }

    @Test
    public void testFindByExternalId(){
        User user = allUsers.get(new Random().nextInt(allUsers.size() - 1));
        UserDTO uTest = userService.convertToDto(user);
        UserDTO uFetch = userService.findByExternalId(user.getExternalId());
        assertThat(uFetch).isEqualToComparingFieldByField(uTest);
    }

    @Test
    public void testFindUsersInTournament(){

    }

    @Test
    public void testFindUsersInTournamentNamed(){

    }

    @Test
    public void testConvertToEntityAndBack() {

    }

    //@Test
    public void testConvertToDtoAndBack() {
        User user = makeRandomUser();
        User userBack = null;
        try {
            userBack = userService.convertToEntity(userService.convertToDto(user));
        } catch (ParseException e) {
            e.printStackTrace();
        }

        System.out.print(user.getUserName() + "\n");
        System.out.print(userBack.getUserName()+ "\n");
        assertThat(user).isEqualToComparingFieldByField(userBack);
    }


    @Test
    public void testExists() {

    }

    @Test
    public void testRegisterForPushNotification() {

    }

    @Test
    public void testPushNotificationForUser(){
    }

    @Test
    public void testPushAll() {
    }

    public UserDTO makeRandomUserDTO(){

        UserDTO u = new UserDTO();

        u.setUserId(new Random().nextLong());
        u.setLocale(UUID.randomUUID().toString());
        u.setLastName(UUID.randomUUID().toString());
        u.setFirstName(UUID.randomUUID().toString());
        u.setPictureUrl(UUID.randomUUID().toString());
        u.setUsername(UUID.randomUUID().toString());

        return u;
    }

    public User makeRandomUser(){

        User u = new User();

        u.setUserId(new Random().nextLong());
        u.setUserName(UUID.randomUUID().toString());
        u.setFirstName(UUID.randomUUID().toString());
        u.setLastName(UUID.randomUUID().toString());
        u.setProfilePictureUrl(UUID.randomUUID().toString());
        u.setLocale(UUID.randomUUID().toString());
        u.setEmail(UUID.randomUUID().toString());
        u.setExternalId(UUID.randomUUID().toString());
        u.setExternalIdProvider(UUID.randomUUID().toString());
        u.setPassword(UUID.randomUUID().toString());
        u.setPushId(UUID.randomUUID().toString());

        return u;
    }
}
